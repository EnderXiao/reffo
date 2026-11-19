/** Reject credentials, paths and insecure remote origins before sending credentials. */
export function secureOrigin(value: string, label: string): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error(label + ' 必须为 HTTPS origin（本地允许 loopback HTTP），不能包含路径、凭据或查询参数');
  }
  const loopback = url.hostname === 'localhost' || url.hostname === '[::1]' || /^127(?:\.\d{1,3}){3}$/.test(url.hostname);
  if ((url.protocol !== 'https:' && !(url.protocol === 'http:' && loopback)) ||
      url.username || url.password || url.pathname !== '/' || url.search || url.hash) {
    throw new Error(label + ' 必须为 HTTPS origin（本地允许 loopback HTTP），不能包含路径、凭据或查询参数');
  }
  return url.origin;
}
