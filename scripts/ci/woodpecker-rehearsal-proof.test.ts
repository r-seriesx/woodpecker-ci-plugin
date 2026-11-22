import { expect, test } from "bun:test";
import { readRehearsalProof } from "./woodpecker-rehearsal-proof.js";

const sha = "a".repeat(40);
const branch = "rehearsal/jur-1088";
const pipeline = { number: 123, branch, ref: `refs/heads/${branch}`, commit: sha, event: "push", status: "success" };
const workflows = [{ name: "ci", state: "success", children: [{ name: "check", state: "success" }] }];
const repo = { id: 21, forge_id: 1, forge_remote_id: "1372674879", full_name: "r-seriesx/woodpecker-ci-plugin", visibility: "public" };
function fixture(runs: unknown = [pipeline], detail: unknown = { ...pipeline, workflows }, identity: unknown = repo) {
  const mocked: typeof fetch = Object.assign(
    async (input: string | URL | Request, init?: RequestInit) => {
      const url = new URL(input instanceof Request ? input.url : input);
      expect(url.origin).toBe("https://ci.jurislm.com");
      expect(init?.redirect).toBe("error");
      expect(new Headers(init?.headers).has("Authorization")).toBe(false);
      switch (url.pathname) {
        case "/api/repos/21": return Response.json(identity);
        case "/api/repos/21/pipelines":
          expect(url.searchParams.get("branch")).toBe(branch);
          expect(url.searchParams.get("event")).toBe("push");
          return Response.json(runs);
        case "/api/repos/21/pipelines/123": return Response.json(detail);
        default: throw new Error("Unexpected readback");
      }
    },
    { preconnect: fetch.preconnect }
  );
  return mocked;
}

test("accepts only first-party evidence for the exact branch and commit with a successful ci check", async () => {
  expect(await readRehearsalProof(sha, fixture())).toBe(123);
  expect(await readRehearsalProof(sha, fixture([{ ...pipeline, status: "running" }]))).toBeNull();
  expect(await readRehearsalProof(sha, fixture([{ ...pipeline, event: "tag" }]))).toBeNull();
  expect(await readRehearsalProof(sha, fixture([{ ...pipeline, commit: "c".repeat(40) }]))).toBeNull();
});

test("fails closed on wrong provenance, duplicate evidence, or additional publishing workflows", async () => {
  await expect(readRehearsalProof(sha, fixture([pipeline, pipeline]))).rejects.toThrow("Ambiguous");
  await expect(readRehearsalProof(sha, fixture([{ ...pipeline, status: "failure" }]))).rejects.toThrow("did not succeed");
  await expect(readRehearsalProof(sha, fixture([pipeline], { ...pipeline, workflows: [...workflows, { ...workflows[0], name: "release" }] }))).rejects.toThrow("did not match");
  await expect(readRehearsalProof(sha, fixture([pipeline], { ...pipeline, workflows }, { ...repo, forge_remote_id: "42" }))).rejects.toThrow();
});
