import { z } from "zod";

const branch = "rehearsal/jur-1088";
const origin = "https://ci.jurislm.com";
const repoPath = "/api/repos/21";
const sourceSha = z.string().regex(/^[a-f0-9]{40}$/);
const repoSchema = z.object({
  id: z.literal(21),
  forge_id: z.literal(1),
  forge_remote_id: z.literal("1372674879"),
  full_name: z.literal("r-seriesx/woodpecker-ci-plugin"),
  visibility: z.literal("public"),
});
const pipelineSchema = z.object({
  number: z.number().int().positive(),
  branch: z.string(),
  ref: z.string(),
  commit: sourceSha,
  event: z.string(),
  status: z.string(),
});
const detailSchema = pipelineSchema.extend({
  workflows: z.array(z.object({
    name: z.string(),
    state: z.string(),
    children: z.array(z.object({ name: z.string(), state: z.string() })),
  })),
});

export async function readRehearsalProof(sha: string, fetchImpl = fetch): Promise<number | null> {
  sourceSha.parse(sha);
  const get = async (path: string): Promise<unknown> => {
    const response = await fetchImpl(new URL(path, origin), {
      redirect: "error",
      signal: AbortSignal.timeout(10_000),
      headers: { Accept: "application/json" },
    });
    if (!response.ok || response.redirected) throw new Error(`Woodpecker readback failed (${response.status})`);
    return response.json();
  };
  repoSchema.parse(await get(repoPath));
  const list = pipelineSchema.array().parse(await get(`${repoPath}/pipelines?branch=${encodeURIComponent(branch)}&event=push&perPage=50`));
  const matches = (run: z.infer<typeof pipelineSchema>) =>
    run.branch === branch && run.ref === `refs/heads/${branch}` && run.commit === sha && run.event === "push";
  const matching = list.filter(matches);
  if (matching.length > 1) throw new Error("Ambiguous Woodpecker pipelines for exact SHA");
  const run = matching[0];
  if (!run) return null;
  if (["pending", "running", "blocked", "created"].includes(run.status)) return null;
  if (run.status !== "success") throw new Error("Exact Woodpecker pipeline did not succeed");
  const proof = detailSchema.parse(await get(`${repoPath}/pipelines/${run.number}`));
  const workflow = proof.workflows[0];
  const check = workflow?.children.filter((step) => step.name === "check") ?? [];
  if (!matches(proof) || proof.number !== run.number || proof.status !== "success" ||
      proof.workflows.length !== 1 || workflow?.name !== "ci" || workflow.state !== "success" ||
      check.length !== 1 || check[0]?.state !== "success")
    throw new Error("Woodpecker proof did not match exact isolated CI workflow");
  return run.number;
}

if (import.meta.main) {
  const sha = sourceSha.parse(process.env.GITHUB_SHA);
  const event = process.env.GITHUB_EVENT_NAME;
  const ref = process.env.GITHUB_REF;
  if (event !== "push" || ref !== `refs/heads/${branch}` ||
      process.env.GITHUB_REPOSITORY_ID !== "1372674879")
    throw new Error("Invalid rehearsal event");
  let pipeline: number | null = null;
  for (let attempt = 0; attempt < 30 && pipeline === null; attempt++) {
    if (attempt) await Bun.sleep(10_000);
    pipeline = await readRehearsalProof(sha);
  }
  if (pipeline === null) throw new Error("Timed out waiting for exact Woodpecker check");
  console.log(JSON.stringify({ sourceSha: sha, ref, woodpeckerRepoId: 21, pipeline, workflow: "ci", check: "check" }));
}
