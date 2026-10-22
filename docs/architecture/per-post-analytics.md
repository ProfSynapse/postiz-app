# Per-post analytics

Ported from upstream gitroomhq/postiz-app (`5cca81e0` feat: post analytics,
`ecb1b55c` analytics public API, `96b78476` token-retry fix) and adapted to this
fork's provider changes (#22 Facebook Page Insights, #23 Instagram analytics).

## Public API

All routes use the organization API key in `Authorization` and only resolve
posts of that organization. Deleted posts, posts on another organization's
channel, posts without a `releaseId`, disabled/deleted channels and providers
without per-post insights return `[]` (never an error).

### `GET /public/v1/analytics/post/:postId?date=N`

Same route and response as upstream: an array of
`{ label, percentageChange, data: [{ date: 'YYYY-MM-DD', total: '<string>' }] }`.
Series with `average: true` are ratios/averages and must not be summed.

### `GET /public/v1/analytics/posts?ids=a,b,c&date=N`

Fork-only batch route. `ids` is comma-separated and/or repeated; 1-20 unique
ids of `[A-Za-z0-9_-]`, otherwise `400`. Returns `{ [postId]: AnalyticsData[] }`
with one key per requested id. Posts are loaded in one query and fetched with
a concurrency of 4; an expired channel token is refreshed once per channel.

`date` is the look-back in days (default 30, clamped to 1-365). Only YouTube
uses it; the other providers return lifetime totals dated today.

`GET /public/v1/posts` now includes `releaseId` (the platform's own post or
video id) so clients can key on it.

## Caching

Results are cached in Redis under `integration:{orgId}:{postId}:{date}` (the
upstream key): 1 hour when non-empty, 5 minutes when empty, 1 second in
development.

## Rate limiting

`ThrottlerBehindProxyGuard` only meters `/public/v1/posts...` (bucket `posts`)
and `/public/v1/upload...` (bucket `other`), `API_LIMIT` per hour (default 30).
The analytics routes, including `/public/v1/analytics/posts`, are not
throttled. Bucket matching is anchored on the `/public/v1/posts` prefix so the
batch route's `/posts` suffix can't land in the posts bucket
(`publicApiThrottleBucket`).

## Metrics per platform

| Provider | Source | Labels |
| --- | --- | --- |
| YouTube | YouTube Analytics `reports.query`, `filters=video==<id>`, `dimensions=day` | Views, Estimated Minutes Watched, Average View Duration*, Average View Percentage*, Likes, Comments, Shares, Subscribers Gained (daily). Until Analytics has rows (1-3 days), upstream's `videos.list` lifetime snapshot: Views, Likes, Comments |
| Instagram (Facebook login and Instagram login) | `/{media-id}/insights` (v21.0), metric set by `media_product_type` | Views, Reach, Saves, Likes, Comments, Shares, Total Interactions; Reels add Average Watch Time (ms)*; Stories: Views, Reach, Shares, Total Interactions |
| Facebook Page feed post | `/{page_post}/insights` (v23.0) + `?fields=shares,comments.summary(true)` | Reach (`post_total_media_view_unique`), Views (`post_media_view`), Clicks, Reactions, Comments, Shares |
| Facebook Page video | `/{video-id}/video_insights` (v23.0) | Views, Plays, Reactions, Engagement |
| LinkedIn Page | `organizationalEntityShareStatistics` with `shares=List(...)` or `ugcPosts=List(...)` (lifetime) | Impressions, Unique Impressions, Clicks, Likes, Comments, Shares, Engagement*; socialActions likes/comments when LinkedIn omits the post |

`*` = `average: true`. No deprecated `post_impressions*` or Instagram
`impressions`/`plays` metric is requested. A metric Meta rejects (`#100`) is
dropped and the rest are kept.
