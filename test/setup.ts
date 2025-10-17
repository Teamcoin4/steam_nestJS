expect.extend({
  toBeOneOf(received: unknown, expected: unknown[]) {
    const pass = expected.includes(received);
    if (pass) {
      return {
        message: () =>
          `expected ${String(received)} not to be one of ${expected.map(String).join(', ')}`,
        pass: true,
      };
    } else {
      return {
        message: () =>
          `expected ${String(received)} to be one of ${expected.map(String).join(', ')}`,
        pass: false,
      };
    }
  },
});

// TypeScript 타입 정의
declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace jest {
    interface Matchers<R> {
      toBeOneOf(expected: unknown[]): R;
    }
    interface Expect {
      toBeOneOf(expected: unknown[]): this;
    }
    interface InverseAsymmetricMatchers {
      toBeOneOf(expected: unknown[]): void;
    }
  }
}

export {};
