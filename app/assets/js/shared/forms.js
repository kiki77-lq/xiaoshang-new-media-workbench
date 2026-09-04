export function serializeForm(form) {
  return Object.fromEntries(new FormData(form).entries());
}
