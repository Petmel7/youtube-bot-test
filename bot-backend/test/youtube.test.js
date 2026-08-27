const test = require("node:test");
const assert = require("node:assert/strict");

process.env.YOUTUBE_API_BASE = process.env.YOUTUBE_API_BASE || "https://youtube.test/v3";

const { validateYoutubeVideosQuery } = require("../src/utils/validators");
const { getUserChannelInfo, getChannelVideos } = require("../src/services/youtubeService");

const user = {
    _id: "64b000000000000000000010",
    tokens: {
        access_token: "access-token",
        refresh_token: "refresh-token",
        expiry_date: Date.now() + 60_000
    }
};

const jsonResponse = (body, ok = true) => ({
    ok,
    json: async () => body
});

test("validateYoutubeVideosQuery defaults and bounds pagination params", () => {
    assert.deepEqual(validateYoutubeVideosQuery({}), {
        maxResults: 12,
        pageToken: undefined
    });
    assert.deepEqual(validateYoutubeVideosQuery({ maxResults: "25", pageToken: "CAUQAA" }), {
        maxResults: 25,
        pageToken: "CAUQAA"
    });

    assert.throws(() => validateYoutubeVideosQuery({ maxResults: "0" }), { code: "INVALID_MAX_RESULTS" });
    assert.throws(() => validateYoutubeVideosQuery({ maxResults: "26" }), { code: "INVALID_MAX_RESULTS" });
    assert.throws(() => validateYoutubeVideosQuery({ maxResults: "ten" }), { code: "INVALID_MAX_RESULTS" });
    assert.throws(() => validateYoutubeVideosQuery({ pageToken: "x".repeat(257) }), { code: "FIELD_TOO_LONG" });
    assert.throws(() => validateYoutubeVideosQuery({ pageToken: "bad token" }), { code: "INVALID_PAGE_TOKEN" });
});

test("getUserChannelInfo fetches uploads playlist details", async (t) => {
    t.mock.method(global, "fetch", async (url, options) => {
        const parsed = new URL(url);

        assert.equal(parsed.pathname.endsWith("/channels"), true);
        assert.equal(parsed.searchParams.get("part"), "contentDetails");
        assert.equal(parsed.searchParams.get("mine"), "true");
        assert.equal(options.headers.Authorization, "Bearer access-token");

        return jsonResponse({
            items: [
                {
                    id: "channel-1",
                    contentDetails: {
                        relatedPlaylists: {
                            uploads: "uploads-1"
                        }
                    }
                }
            ]
        });
    });

    const result = await getUserChannelInfo(user);

    assert.deepEqual(result, {
        channelId: "channel-1",
        uploadsPlaylistId: "uploads-1"
    });
});

test("getChannelVideos fetches uploads playlist page and returns pagination metadata", async (t) => {
    const calls = [];
    t.mock.method(global, "fetch", async (url, options) => {
        calls.push({ url: String(url), options });
        const parsed = new URL(url);

        if (parsed.pathname.endsWith("/playlistItems")) {
            assert.equal(parsed.searchParams.get("part"), "snippet,contentDetails");
            assert.equal(parsed.searchParams.get("playlistId"), "uploads-1");
            assert.equal(parsed.searchParams.get("maxResults"), "2");
            assert.equal(parsed.searchParams.get("pageToken"), "CAUQAA");
            assert.equal(options.headers.Authorization, "Bearer access-token");

            return jsonResponse({
                items: [
                    { contentDetails: { videoId: "video-1" } },
                    { contentDetails: { videoId: "video-2" } },
                    { contentDetails: { videoId: "video-1" } },
                    { snippet: { resourceId: { videoId: "video-3" } } },
                    { contentDetails: {} }
                ],
                nextPageToken: "CBQQAA",
                prevPageToken: "CAAQAA",
                pageInfo: {
                    totalResults: 20,
                    resultsPerPage: 2
                }
            });
        }

        if (parsed.pathname.endsWith("/videos")) {
            assert.equal(parsed.searchParams.get("part"), "snippet,contentDetails,statistics");
            assert.equal(parsed.searchParams.get("id"), "video-1,video-2,video-3");
            assert.equal(options.headers.Authorization, "Bearer access-token");

            return jsonResponse({
                items: [
                    {
                        id: "video-2",
                        snippet: {
                            title: "Second",
                            description: "Two",
                            publishedAt: "2026-08-02T00:00:00Z",
                            thumbnails: { medium: { url: "https://img.test/2.jpg" } }
                        },
                        contentDetails: { duration: "PT2M" },
                        statistics: { viewCount: "20", likeCount: "3", commentCount: "4" }
                    },
                    {
                        id: "video-1",
                        snippet: {
                            title: "First",
                            description: "One",
                            publishedAt: "2026-08-01T00:00:00Z",
                            thumbnails: { medium: { url: "https://img.test/1.jpg" } }
                        },
                        contentDetails: { duration: "PT1M" },
                        statistics: { viewCount: "10", likeCount: "2", commentCount: "1" }
                    }
                ]
            });
        }

        throw new Error(`Unexpected URL: ${url}`);
    });

    const result = await getChannelVideos(user, "uploads-1", {
        maxResults: 2,
        pageToken: "CAUQAA"
    });

    assert.equal(calls.length, 2);
    assert.equal(calls.some(call => new URL(call.url).pathname.endsWith("/search")), false);
    assert.equal(result.nextPageToken, "CBQQAA");
    assert.equal(result.prevPageToken, "CAAQAA");
    assert.deepEqual(result.pageInfo, { totalResults: 20, resultsPerPage: 2 });
    assert.deepEqual(result.videos.map(video => video.videoId), ["video-1", "video-2"]);
    assert.equal(result.videos.some(video => video.videoId === "video-3"), false);
    assert.equal(result.videos[0].title, "First");
    assert.equal(result.videos[0].views, "10");
});

test("getChannelVideos returns empty page without fetching video details", async (t) => {
    const calls = [];
    t.mock.method(global, "fetch", async (url, options) => {
        calls.push(String(url));
        const parsed = new URL(url);

        assert.equal(parsed.pathname.endsWith("/playlistItems"), true);
        assert.equal(parsed.searchParams.get("part"), "snippet,contentDetails");
        assert.equal(parsed.searchParams.get("playlistId"), "uploads-empty");
        assert.equal(parsed.searchParams.get("maxResults"), "12");
        assert.equal(options.headers.Authorization, "Bearer access-token");

        return jsonResponse({
            items: [],
            pageInfo: {
                totalResults: 0,
                resultsPerPage: 12
            }
        });
    });

    const result = await getChannelVideos(user, "uploads-empty", { maxResults: 12 });

    assert.equal(calls.length, 1);
    assert.deepEqual(result, {
        videos: [],
        nextPageToken: null,
        prevPageToken: null,
        pageInfo: {
            totalResults: 0,
            resultsPerPage: 12
        }
    });
});
