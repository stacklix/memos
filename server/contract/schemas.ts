import { z } from "zod";

/** Aligns with `memos.api.v1.SignInRequest` JSON (camelCase). */
export const signInRequestSchema = z.object({
  passwordCredentials: z
    .object({
      username: z.string(),
      password: z.string(),
    })
    .optional(),
  ssoCredentials: z.unknown().optional(),
});

export type SignInRequest = z.infer<typeof signInRequestSchema>;
