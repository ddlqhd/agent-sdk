import { Agent, createOpenAI } from '@ddlqhd/agent-sdk';

async function main() {
  const agent = new Agent({
    model: createOpenAI({
      apiKey: process.env.OPENAI_API_KEY
    }),
    subagent: {
      enabled: true,
      maxDepth: 1,
      maxParallel: 2,
      allowDangerousTools: false
    }
  });

  const result = await agent.run(
    '请先调用 Agent 工具，让子代理扫描项目并给出 3 条可执行改进建议。'
  );

  console.log(result.content);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

