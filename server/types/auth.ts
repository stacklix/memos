export type UserRole = "ADMIN" | "USER";

export type AuthPrincipal = {
  username: string;
  role: UserRole;
  via: "jwt" | "pat";
};
