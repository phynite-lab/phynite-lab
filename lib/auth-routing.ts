export function sessionHome(isAdmin: boolean) {
  return isAdmin ? '/developer/overview' : '/workspace';
}
