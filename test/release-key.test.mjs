import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { describe, test } from "node:test";
import { packumentUrl, releaseKey } from "../scripts/lib.mjs";

describe("releaseKey", () => {
    // The SHA-512 digest of the bytes "garden 1.2.0", written down once from node:crypto.
    const INTEGRITY = "sha512-HdBUWMi6KxJ8VqmY9vGpBkkhirN0O/D15Ta1WmPYtH3hucdxb/6Imsq22kzo4rzTgrAfnA3bFvA3fHApiuyB8g==";
    const KEY = "1dd05458c8ba2b127c56a998f6f1a906";

    test("is the first 32 hexadecimal characters of the digest", () => {
        assert.equal(releaseKey(INTEGRITY), KEY);
        const digest = createHash("sha512").update("garden 1.2.0").digest();
        assert.equal(`sha512-${digest.toString("base64")}`, INTEGRITY);
        assert.equal(digest.toString("hex").slice(0, 32), KEY);
    });

    test("refuses anything that is not a sha512 integrity", () => {
        assert.throws(() => releaseKey("sha1-2jmj7l5rSw0yVb/vlWAYkK/YBwk="), TypeError);
        assert.throws(() => releaseKey("sha512-short"), TypeError);
    });
});

describe("packumentUrl", () => {
    test("writes a scoped name's slash as %2f", () => {
        assert.equal(packumentUrl("https://registry.npmjs.org", "@example/etherpk-extension-garden"), "https://registry.npmjs.org/@example%2fetherpk-extension-garden");
        assert.equal(packumentUrl("http://127.0.0.1:4873/", "etherpk-extension-garden"), "http://127.0.0.1:4873/etherpk-extension-garden");
    });
});
