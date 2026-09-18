import { describe, it, expect } from 'vitest';
import { zodToJsonSchema } from '../../packages/agent-sdk/src/models/base.js';
import { z } from 'zod';

describe('Schema Conversion', () => {
  it('should convert string schema', () => {
    const schema = z.string().describe('A string value');
    const jsonSchema = zodToJsonSchema(schema) as any;

    expect(jsonSchema.type).toBe('string');
    expect(jsonSchema.description).toBe('A string value');
  });

  it('should convert number schema', () => {
    const schema = z.number();
    const jsonSchema = zodToJsonSchema(schema) as any;

    expect(jsonSchema.type).toBe('number');
  });

  it('should convert boolean schema', () => {
    const schema = z.boolean();
    const jsonSchema = zodToJsonSchema(schema) as any;

    expect(jsonSchema.type).toBe('boolean');
  });

  it('should convert object schema', () => {
    const schema = z.object({
      name: z.string(),
      age: z.number(),
      active: z.boolean()
    });

    const jsonSchema = zodToJsonSchema(schema) as any;

    expect(jsonSchema.type).toBe('object');
    expect(jsonSchema.properties.name.type).toBe('string');
    expect(jsonSchema.properties.age.type).toBe('number');
    expect(jsonSchema.properties.active.type).toBe('boolean');
    expect(jsonSchema.required).toEqual(['name', 'age', 'active']);
  });

  it('should handle optional fields', () => {
    const schema = z.object({
      required: z.string(),
      optional: z.string().optional()
    });

    const jsonSchema = zodToJsonSchema(schema) as any;

    expect(jsonSchema.required).toEqual(['required']);
  });

  it('should convert enum schema', () => {
    const schema = z.enum(['a', 'b', 'c']);
    const jsonSchema = zodToJsonSchema(schema) as any;

    expect(jsonSchema.type).toBe('string');
    expect(jsonSchema.enum).toEqual(['a', 'b', 'c']);
  });

  it('should convert array schema', () => {
    const schema = z.array(z.string());
    const jsonSchema = zodToJsonSchema(schema) as any;

    expect(jsonSchema.type).toBe('array');
    expect(jsonSchema.items.type).toBe('string');
  });

  it('should convert nested object', () => {
    const schema = z.object({
      user: z.object({
        name: z.string(),
        email: z.string()
      })
    });

    const jsonSchema = zodToJsonSchema(schema) as any;

    expect(jsonSchema.type).toBe('object');
    expect(jsonSchema.properties.user.type).toBe('object');
    expect(jsonSchema.properties.user.properties.name.type).toBe('string');
  });
});
