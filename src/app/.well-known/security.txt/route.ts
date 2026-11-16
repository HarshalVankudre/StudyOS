import { securityTxt } from "@/lib/security-txt";

/** RFC 9116 security contact (lib/security-txt.ts). */
export function GET() {
  return new Response(securityTxt(), {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "public, max-age=86400",
    },
  });
}
