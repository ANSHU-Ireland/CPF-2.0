/**
 * Outbound mail delivery ports (CPF-37).
 *
 * `consoleAdapter` is the safe default: it logs only message metadata (type,
 * recipient, subject) and NEVER the body, since future templates may carry
 * personal data. `smtpAdapter` is used only when SMTP_HOST is configured.
 */
import nodemailer from "nodemailer";
import type { AppConfig } from "../../config.js";

export interface MailMessage {
  to: string;
  subject: string;
  body: string;
}

export interface MailPort {
  send(message: MailMessage): Promise<void>;
}

const HTML_ESCAPES: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
};

/** Escapes user-supplied content before interpolation into an HTML e-mail body/subject. */
export function escapeHtml(input: string): string {
  return input.replace(/[&<>"']/g, (char) => HTML_ESCAPES[char]!);
}

export function consoleAdapter(): MailPort {
  return {
    async send(message: MailMessage): Promise<void> {
      console.log(
        `[mail:console] to=${message.to} subject=${JSON.stringify(message.subject)} (body suppressed — console adapter never logs message bodies)`,
      );
    },
  };
}

export interface SmtpAdapterConfig {
  host: string;
  port: number;
  secure: boolean;
  user?: string | undefined;
  password?: string | undefined;
  from: string;
}

export function smtpAdapter(config: SmtpAdapterConfig): MailPort {
  const transporter = nodemailer.createTransport({
    host: config.host,
    port: config.port,
    secure: config.secure,
    auth: config.user ? { user: config.user, pass: config.password } : undefined,
  });
  return {
    async send(message: MailMessage): Promise<void> {
      await transporter.sendMail({
        from: config.from,
        to: message.to,
        subject: message.subject,
        html: message.body,
      });
    },
  };
}

/** Selects the SMTP adapter when configured, otherwise falls back to the console adapter. */
export function createMailPort(config: AppConfig): MailPort {
  if (!config.SMTP_HOST) return consoleAdapter();
  return smtpAdapter({
    host: config.SMTP_HOST,
    port: config.SMTP_PORT,
    secure: config.SMTP_SECURE,
    user: config.SMTP_USER,
    password: config.SMTP_PASSWORD,
    from: config.SMTP_FROM,
  });
}
