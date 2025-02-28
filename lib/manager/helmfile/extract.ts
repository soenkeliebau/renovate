import is from '@sindresorhus/is';
import { loadAll } from 'js-yaml';
import { HelmDatasource } from '../../datasource/helm';
import { logger } from '../../logger';
import { regEx } from '../../util/regex';
import type { ExtractConfig, PackageDependency, PackageFile } from '../types';
import type { Doc } from './types';

const isValidChartName = (name: string): boolean =>
  !regEx(/[!@#$%^&*(),.?":{}/|<>A-Z]/).test(name);

export function extractPackageFile(
  content: string,
  fileName: string,
  config: ExtractConfig
): PackageFile {
  let deps = [];
  let docs: Doc[];
  const aliases: Record<string, string> = {};
  try {
    docs = loadAll(content, null, { json: true });
  } catch (err) {
    logger.debug({ err, fileName }, 'Failed to parse helmfile helmfile.yaml');
    return null;
  }
  for (const doc of docs) {
    if (!(doc && is.array(doc.releases))) {
      continue;
    }

    if (doc.repositories) {
      for (let i = 0; i < doc.repositories.length; i += 1) {
        aliases[doc.repositories[i].name] = doc.repositories[i].url;
      }
    }
    logger.debug({ aliases }, 'repositories discovered.');

    deps = doc.releases.map((dep) => {
      let depName = dep.chart;
      let repoName = null;

      if (!is.string(dep.chart)) {
        return {
          depName: dep.name,
          skipReason: 'invalid-name',
        };
      }

      // If starts with ./ is for sure a local path
      if (dep.chart.startsWith('./')) {
        return {
          depName,
          skipReason: 'local-chart',
        };
      }

      if (dep.chart.includes('/')) {
        const v = dep.chart.split('/');
        repoName = v.shift();
        depName = v.join('/');
      } else {
        repoName = dep.chart;
      }

      const res: PackageDependency = {
        depName,
        currentValue: dep.version,
        registryUrls: [aliases[repoName]]
          .concat([config.aliases[repoName]])
          .filter(Boolean),
      };

      // If version is null is probably a local chart
      if (!res.currentValue) {
        res.skipReason = 'local-chart';
      }

      // By definition on helm the chart name should be lowercase letter + number + -
      // However helmfile support templating of that field
      if (!isValidChartName(res.depName)) {
        res.skipReason = 'unsupported-chart-type';
      }

      // Skip in case we cannot locate the registry
      if (is.emptyArray(res.registryUrls)) {
        res.skipReason = 'unknown-registry';
      }

      return res;
    });
  }

  if (!deps.length) {
    logger.debug({ fileName }, 'helmfile.yaml has no releases');
    return null;
  }

  return { deps, datasource: HelmDatasource.id } as PackageFile;
}
