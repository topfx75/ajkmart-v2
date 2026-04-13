/**
 * expo-task-manager web shim
 * Background tasks are not supported in the browser — all functions are intentional no-ops.
 * Use Platform.OS !== 'web' guards before calling startLocationUpdatesAsync or
 * any background task API to avoid silent failures.
 */

export function defineTask(_name, _fn) {}

export async function isTaskRegisteredAsync(_name) {
  return false;
}

export async function getRegisteredTasksAsync() {
  return [];
}

export async function unregisterAllTasksAsync() {}

export async function unregisterTaskAsync(_name) {}

export async function getTaskOptionsAsync(_name) {
  return null;
}
