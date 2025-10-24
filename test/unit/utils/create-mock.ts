import { jest } from '@jest/globals';

export function createMock<T>(): T {
  const store: { [key: string]: unknown } = {};

  return new Proxy(store, {
    get: (target, prop: string) => {
      if (!Object.prototype.hasOwnProperty.call(target, prop)) {
        target[prop] = jest.fn(); // 최초 접근시 jest.fn() 자동 생성
      }

      return target[prop];
    },
  }) as T;
}
