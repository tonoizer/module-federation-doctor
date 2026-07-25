export async function loadDynamic(moduleId: string) {
  return import(moduleId);
}
