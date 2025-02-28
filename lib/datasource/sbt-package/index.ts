import { XmlDocument } from 'xmldoc';
import { logger } from '../../logger';
import { regEx } from '../../util/regex';
import { ensureTrailingSlash } from '../../util/url';
import * as ivyVersioning from '../../versioning/ivy';
import { compare } from '../../versioning/maven/compare';
import { MAVEN_REPO } from '../maven/common';
import { downloadHttpProtocol } from '../maven/util';
import { parseIndexDir } from '../sbt-plugin/util';
import type { GetReleasesConfig, ReleaseResult } from '../types';

export const id = 'sbt-package';
export const customRegistrySupport = true;
export const defaultRegistryUrls = [MAVEN_REPO];
export const defaultVersioning = ivyVersioning.id;
export const registryStrategy = 'hunt';

export async function getArtifactSubdirs(
  searchRoot: string,
  artifact: string,
  scalaVersion: string
): Promise<string[] | null> {
  const { body: indexContent } = await downloadHttpProtocol(
    ensureTrailingSlash(searchRoot),
    'sbt'
  );
  if (indexContent) {
    const parseSubdirs = (content: string): string[] =>
      parseIndexDir(content, (x) => {
        if (x === artifact) {
          return true;
        }
        if (x.startsWith(`${artifact}_native`)) {
          return false;
        }
        if (x.startsWith(`${artifact}_sjs`)) {
          return false;
        }
        return x.startsWith(`${artifact}_`);
      });
    let artifactSubdirs = parseSubdirs(indexContent);
    if (
      scalaVersion &&
      artifactSubdirs.includes(`${artifact}_${scalaVersion}`)
    ) {
      artifactSubdirs = [`${artifact}_${scalaVersion}`];
    }
    return artifactSubdirs;
  }

  return null;
}

export async function getPackageReleases(
  searchRoot: string,
  artifactSubdirs: string[] | null
): Promise<string[] | null> {
  if (artifactSubdirs) {
    const releases: string[] = [];
    const parseReleases = (content: string): string[] =>
      parseIndexDir(content, (x) => !regEx(/^\.+$/).test(x));
    for (const searchSubdir of artifactSubdirs) {
      const { body: content } = await downloadHttpProtocol(
        ensureTrailingSlash(`${searchRoot}/${searchSubdir}`),
        'sbt'
      );
      if (content) {
        const subdirReleases = parseReleases(content);
        subdirReleases.forEach((x) => releases.push(x));
      }
    }
    if (releases.length) {
      return [...new Set(releases)].sort(compare);
    }
  }

  return null;
}

export function getLatestVersion(versions: string[] | null): string | null {
  if (versions?.length) {
    return versions.reduce((latestVersion, version) =>
      compare(version, latestVersion) === 1 ? version : latestVersion
    );
  }
  return null;
}

export async function getUrls(
  searchRoot: string,
  artifactDirs: string[] | null,
  version: string | null
): Promise<Partial<ReleaseResult>> {
  const result: Partial<ReleaseResult> = {};

  if (!artifactDirs?.length) {
    return result;
  }

  if (!version) {
    return result;
  }

  for (const artifactDir of artifactDirs) {
    const [artifact] = artifactDir.split('_');
    const pomFileNames = [
      `${artifactDir}-${version}.pom`,
      `${artifact}-${version}.pom`,
    ];

    for (const pomFileName of pomFileNames) {
      const pomUrl = `${searchRoot}/${artifactDir}/${version}/${pomFileName}`;
      const { body: content } = await downloadHttpProtocol(pomUrl, 'sbt');

      if (content) {
        const pomXml = new XmlDocument(content);

        const homepage = pomXml.valueWithPath('url');
        if (homepage) {
          result.homepage = homepage;
        }

        const sourceUrl = pomXml.valueWithPath('scm.url');
        if (sourceUrl) {
          result.sourceUrl = sourceUrl
            .replace(regEx(/^scm:/), '')
            .replace(regEx(/^git:/), '')
            .replace(regEx(/^git@github.com:/), 'https://github.com/')
            .replace(regEx(/\.git$/), '');
        }

        return result;
      }
    }
  }

  return result;
}

export async function getReleases({
  lookupName,
  registryUrl,
}: GetReleasesConfig): Promise<ReleaseResult | null> {
  // istanbul ignore if
  if (!registryUrl) {
    return null;
  }

  const [groupId, artifactId] = lookupName.split(':');
  const groupIdSplit = groupId.split('.');
  const artifactIdSplit = artifactId.split('_');
  const [artifact, scalaVersion] = artifactIdSplit;

  const repoRoot = ensureTrailingSlash(registryUrl);
  const searchRoots: string[] = [];
  // Optimize lookup order
  searchRoots.push(`${repoRoot}${groupIdSplit.join('/')}`);
  searchRoots.push(`${repoRoot}${groupIdSplit.join('.')}`);

  for (let idx = 0; idx < searchRoots.length; idx += 1) {
    const searchRoot = searchRoots[idx];
    const artifactSubdirs = await getArtifactSubdirs(
      searchRoot,
      artifact,
      scalaVersion
    );
    const versions = await getPackageReleases(searchRoot, artifactSubdirs);
    const latestVersion = getLatestVersion(versions);
    const urls = await getUrls(searchRoot, artifactSubdirs, latestVersion);

    const dependencyUrl = searchRoot;

    if (versions) {
      return {
        ...urls,
        dependencyUrl,
        releases: versions.map((v) => ({ version: v })),
      };
    }
  }

  logger.debug(
    `No versions found for ${lookupName} in ${searchRoots.length} repositories`
  );
  return null;
}
