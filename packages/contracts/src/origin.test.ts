import { expect, test } from 'vitest';
import { publicOrigin, trustedRequestOrigin } from './origin';

test('public hosting trusts one configured HTTPS origin behind a TLS proxy', () => {
  expect(trustedRequestOrigin('http:', 'athena.example', 'https://athena.example')).toBe('https://athena.example');
  for (const host of ['evil.example', 'athena.example.evil.test', '127.0.0.1', 'athena.example:1234']) {
    expect(() => trustedRequestOrigin('https:', host, 'https://athena.example')).toThrow();
  }
  for (const value of ['http://athena.example', 'https://user:password@athena.example', 'https://athena.example/path', 'https://athena.example?x=1']) expect(() => publicOrigin(value)).toThrow();
});

test('without explicit public configuration only loopback hosts are accepted', () => {
  expect(trustedRequestOrigin('http:', '127.0.0.1:3100')).toBe('http://127.0.0.1:3100');
  expect(() => trustedRequestOrigin('https:', 'localhost.evil.example')).toThrow();
});
