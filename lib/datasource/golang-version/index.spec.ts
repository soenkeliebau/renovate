import { getPkgReleases } from '..';
import * as httpMock from '../../../test/http-mock';
import { loadFixture } from '../../../test/util';
import { ExternalHostError } from '../../types/errors/external-host-error';
import { GolangVersionDatasource } from '.';

const golangReleasesContent = loadFixture('releases.go');
const golangReleasesInvalidContent = loadFixture('releases-invalid.go');
const golangReleasesInvalidContent2 = loadFixture('releases-invalid2.go');
const golangReleasesInvalidContent3 = loadFixture('releases-invalid3.go');
const golangReleasesInvalidContent4 = loadFixture('releases-invalid4.go');

const datasource = GolangVersionDatasource.id;

describe('datasource/golang-version/index', () => {
  describe('getReleases', () => {
    it('parses real data', async () => {
      httpMock
        .scope('https://raw.githubusercontent.com')
        .get('/golang/website/master/internal/history/release.go')
        .reply(200, golangReleasesContent);
      const res = await getPkgReleases({
        datasource,
        depName: 'golang',
      });
      expect(res.releases).toHaveLength(125);
      expect(res.releases[0]).toEqual({
        releaseTimestamp: '2012-03-28T00:00:00.000Z',
        version: '1.0.0',
      });
      expect(res).toMatchSnapshot();
    });

    it('throws ExternalHostError for invalid release with no versions', async () => {
      httpMock
        .scope('https://raw.githubusercontent.com')
        .get('/golang/website/master/internal/history/release.go')
        .reply(200, golangReleasesInvalidContent);
      await expect(
        getPkgReleases({
          datasource,
          depName: 'golang',
        })
      ).rejects.toThrow(ExternalHostError);
    });

    it('throws ExternalHostError for invalid release with wrong termination', async () => {
      httpMock
        .scope('https://raw.githubusercontent.com')
        .get('/golang/website/master/internal/history/release.go')
        .reply(200, golangReleasesInvalidContent2);
      await expect(
        getPkgReleases({
          datasource,
          depName: 'golang',
        })
      ).rejects.toThrow(ExternalHostError);
    });

    it('throws ExternalHostError for empty result', async () => {
      httpMock
        .scope('https://raw.githubusercontent.com')
        .get('/golang/website/master/internal/history/release.go')
        .reply(200, {});
      await expect(
        getPkgReleases({ datasource, depName: 'golang' })
      ).rejects.toThrow(ExternalHostError);
    });

    it('throws ExternalHostError for zero releases extracted', async () => {
      httpMock
        .scope('https://raw.githubusercontent.com')
        .get('/golang/website/master/internal/history/release.go')
        .reply(200, golangReleasesInvalidContent3);
      await expect(
        getPkgReleases({ datasource, depName: 'golang' })
      ).rejects.toThrow(ExternalHostError);
    });

    it('throws ExternalHostError for invalid release semver', async () => {
      httpMock
        .scope('https://raw.githubusercontent.com')
        .get('/golang/website/master/internal/history/release.go')
        .reply(200, golangReleasesInvalidContent4);
      await expect(
        getPkgReleases({ datasource, depName: 'golang' })
      ).rejects.toThrow(ExternalHostError);
    });

    it('returns null for error 404', async () => {
      httpMock
        .scope('https://raw.githubusercontent.com')
        .get('/golang/website/master/internal/history/release.go')
        .reply(404);
      expect(
        await getPkgReleases({ datasource, depName: 'golang' })
      ).toBeNull();
    });
  });
});
