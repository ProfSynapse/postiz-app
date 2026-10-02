import { publicMediaUrl, publicReleaseUrl } from './public-post-details.dto';

describe('public YouTube release links', () => {
  const id = 'aB_cD-12345';
  it.each([
    `https://www.youtube.com/watch?v=${id}`,
    `https://youtu.be/${id}`,
    `https://www.youtube.com/shorts/${id}`,
  ])('preserves %s', (url) => {
    expect(publicReleaseUrl(url, 'youtube')).toBe(url);
  });
  it.each([
    'https://www.youtube.com/watch?v=undefined',
    'https://www.youtube.com/watch?v=',
    `https://www.youtube.com/watch?v=${id}&access_token=SECRET`,
    `https://www.youtube.com/watch?v=${id}&v=${id}`,
    `https://www.youtube.com/watch?v=${id}#SECRET`,
    `https://user:SECRET@www.youtube.com/watch?v=${id}`,
    `https://www.youtube.com.evil.test/watch?v=${id}`,
    `http://www.youtube.com/watch?v=${id}`,
    `https://www.youtube.com:444/watch?v=${id}`,
    'file:///C:/private/path',
  ])('withholds unsafe or invalid link %s', (url) => {
    expect(publicReleaseUrl(url, 'youtube')).toBeNull();
  });
  it('keeps query-bearing media withheld and other safe release links unchanged', () => {
    expect(publicMediaUrl(`https://www.youtube.com/watch?v=${id}`)).toBeNull();
    const url = 'https://www.linkedin.com/feed/update/urn:li:ugcPost:123';
    expect(publicReleaseUrl(url, 'linkedin')).toBe(url);
  });
});
