export type InstanceNotificationEmailSetting = {
  enabled: boolean;
  smtpHost: string;
  smtpPort: number;
  smtpUsername: string;
  smtpPassword: string;
  fromEmail: string;
  fromName: string;
  replyTo: string;
  useTls: boolean;
  useSsl: boolean;
};

export type InstanceNotificationSetting = {
  email: InstanceNotificationEmailSetting;
};

export const DEFAULT_NOTIFICATION_SETTING: InstanceNotificationSetting = {
  email: {
    enabled: false,
    smtpHost: "",
    smtpPort: 0,
    smtpUsername: "",
    smtpPassword: "",
    fromEmail: "",
    fromName: "",
    replyTo: "",
    useTls: false,
    useSsl: false,
  },
};

export function parseInstanceNotificationSetting(raw: string | null): InstanceNotificationSetting {
  if (!raw) return structuredClone(DEFAULT_NOTIFICATION_SETTING);
  try {
    const j = JSON.parse(raw) as {
      email?: {
        enabled?: unknown;
        smtpHost?: unknown;
        smtpPort?: unknown;
        smtpUsername?: unknown;
        smtpPassword?: unknown;
        fromEmail?: unknown;
        fromName?: unknown;
        replyTo?: unknown;
        useTls?: unknown;
        useSsl?: unknown;
      };
    };
    const e = j.email ?? {};
    return {
      email: {
        enabled: Boolean(e.enabled),
        smtpHost: typeof e.smtpHost === "string" ? e.smtpHost : "",
        smtpPort: typeof e.smtpPort === "number" && Number.isFinite(e.smtpPort) ? e.smtpPort : 0,
        smtpUsername: typeof e.smtpUsername === "string" ? e.smtpUsername : "",
        smtpPassword: typeof e.smtpPassword === "string" ? e.smtpPassword : "",
        fromEmail: typeof e.fromEmail === "string" ? e.fromEmail : "",
        fromName: typeof e.fromName === "string" ? e.fromName : "",
        replyTo: typeof e.replyTo === "string" ? e.replyTo : "",
        useTls: Boolean(e.useTls),
        useSsl: Boolean(e.useSsl),
      },
    };
  } catch {
    return structuredClone(DEFAULT_NOTIFICATION_SETTING);
  }
}
