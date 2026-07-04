export const meta = {
  name: 'fan-out-reduce',
  description: 'Draft N answers in parallel, then synthesize the single best one.',
  phases: [{ title: 'Draft' }, { title: 'Synthesize' }]
};

phase('Draft');
const drafts = await parallel(
  [1, 2, 3, 4].map((i) => () =>
    agent(`Draft answer #${i} for the task described in args`, { label: `draft-${i}`, phase: 'Draft' })
  )
);

phase('Synthesize');
return await agent(
  'Synthesize the best single answer from these drafts:\n' + drafts.filter(Boolean).join('\n---\n'),
  { label: 'synthesize', phase: 'Synthesize' }
);
