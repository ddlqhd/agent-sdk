import { createTool } from 'agent-sdk';
import { z } from 'zod';

export const demoCalculatorTool = createTool({
  name: 'DemoCalculator',
  description: 'Perform basic math operations (demo custom tool)',
  parameters: z.object({
    operation: z.enum(['add', 'subtract', 'multiply', 'divide']),
    a: z.number(),
    b: z.number()
  }),
  handler: async (args: { operation: 'add' | 'subtract' | 'multiply' | 'divide'; a: number; b: number }) => {
    const { operation, a, b } = args;
    let result = 0;
    switch (operation) {
      case 'add':
        result = a + b;
        break;
      case 'subtract':
        result = a - b;
        break;
      case 'multiply':
        result = a * b;
        break;
      case 'divide':
        result = b === 0 ? NaN : a / b;
        break;
    }
    return { content: `Result: ${result}` };
  }
});
