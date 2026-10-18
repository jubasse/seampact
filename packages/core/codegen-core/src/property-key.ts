const IDENTIFIER_NAME = /^[A-Za-z_$][A-Za-z0-9_$]*$/;

// A wire name as an object key: bare when it is an identifier name, quoted otherwise, and computed for
// `__proto__`, which as a plain key would set the prototype of an object literal.
export function propertyKey(wireName: string): string {
  if (wireName === "__proto__") return `[${JSON.stringify(wireName)}]`;

  return IDENTIFIER_NAME.test(wireName) ? wireName : JSON.stringify(wireName);
}
