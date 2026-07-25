import cloneDeep from "lodash/cloneDeep";

export function Widget(value: unknown) {
  return cloneDeep(value);
}
