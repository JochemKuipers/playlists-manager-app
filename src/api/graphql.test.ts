import { describe, expect, test } from "bun:test";
import { pickArtistUri } from "./graphql";

describe("pickArtistUri", () => {
  test("prefers exact name match over first hit", () => {
    expect(
      pickArtistUri(
        [
          { uri: "spotify:artist:wrong", name: "Other" },
          { uri: "spotify:artist:right", name: "Carpenter Brut" },
        ],
        "carpenter brut",
      ),
    ).toBe("spotify:artist:right");
  });

  test("falls back to first uri when no exact match", () => {
    expect(
      pickArtistUri(
        [{ uri: "spotify:artist:first", name: "Almost" }],
        "Target",
      ),
    ).toBe("spotify:artist:first");
  });

  test("returns null when empty", () => {
    expect(pickArtistUri([], "X")).toBeNull();
  });
});
