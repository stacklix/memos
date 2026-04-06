import { z } from "zod";

/** Aligns with `memos.api.v1.SignInRequest` JSON (camelCase). */
export const signInRequestSchema = z.object({
  passwordCredentials: z
    .object({
      username: z.string(),
      password: z.string(),
    })
    .optional(),
  ssoCredentials: z
    .object({
      idpName: z.string(),
      code: z.string(),
      redirectUri: z.string(),
      codeVerifier: z.string().optional(),
    })
    .optional(),
});

export type SignInRequest = z.infer<typeof signInRequestSchema>;
