import { describe, expect, test } from "bun:test";
import {
  extractArtistId,
  parseCennoxCsv,
  parseSoulOverAiIds,
  parseZoundhubIds,
} from "./aiArtists";

describe("aiArtists parsers", () => {
  test("extractArtistId from uri/url/bare", () => {
    expect(extractArtistId("spotify:artist:3chqU15yLP7B3XRQpILQY2")).toBe(
      "3chqU15yLP7B3XRQpILQY2",
    );
    expect(
      extractArtistId("https://open.spotify.com/artist/3chqU15yLP7B3XRQpILQY2"),
    ).toBe("3chqU15yLP7B3XRQpILQY2");
    expect(extractArtistId("3chqU15yLP7B3XRQpILQY2")).toBe(
      "3chqU15yLP7B3XRQpILQY2",
    );
    expect(extractArtistId("not-an-id")).toBeNull();
  });

  test("parseSoulOverAiIds skips removed", () => {
    const ids = parseSoulOverAiIds([
      { name: "A", spotify: "spotify:artist:aaaaaaaaaaaaaaaaaaaaaa" },
      {
        name: "B",
        spotifyId: "https://open.spotify.com/artist/bbbbbbbbbbbbbbbbbbbbbb",
        removed: true,
      },
      "legacy-string",
    ]);
    expect(ids).toEqual(["aaaaaaaaaaaaaaaaaaaaaa"]);
  });

  test("parseCennoxCsv takes last column id", () => {
    const ids = parseCennoxCsv(
      "artist,id\nFoo Bar,cccccccccccccccccccccc\nName, With, Comma,dddddddddddddddddddddd\n",
    );
    expect(ids).toEqual(["cccccccccccccccccccccc", "dddddddddddddddddddddd"]);
  });

  test("parseZoundhubIds respects threshold 80", () => {
    const ids = parseZoundhubIds([
      { spotify_id: "eeeeeeeeeeeeeeeeeeeeee", submithub_score: 80 },
      { spotify_id: "ffffffffffffffffffffff", submithub_score: 79.9 },
      { spotify_id: "gggggggggggggggggggggg", submithub_score: null },
    ]);
    expect(ids).toEqual(["eeeeeeeeeeeeeeeeeeeeee"]);
  });
});
