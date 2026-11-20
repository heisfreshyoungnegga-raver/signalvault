// Floating Telegram support button, mounted once in __root.tsx so it is
// reachable from EVERY page — including the immersive engine pages,
// which render no Header/Footer, and login/register/admin/superadmin.
// Design: a white pill with a sand border and ink text on the light
// pages (Telegram blue icon only). It sits above the mobile predictor
// bottom nav (which is ~59px tall, hence the 4.75rem mobile offset) and
// below drawers (z-50), so it never covers a modal or a nav tab.
import { SendHorizontal } from "lucide-react";

const SUPPORT_URL = "https://t.me/pycuepay";

export function SupportFloat() {
  return (
    <a
      href={SUPPORT_URL}
      target="_blank"
      rel="noreferrer noopener"
      aria-label="Chat with SignalVault support on Telegram"
      title="Chat with support"
      className="support-float fixed right-4 z-40 flex items-center gap-2 rounded-full border border-border bg-white py-3 pl-4 pr-4 text-foreground shadow-soft ring-1 ring-black/5 outline-none transition-colors duration-200 hover:border-primary/40 hover:text-primary focus-visible:ring-4 focus-visible:ring-primary/40 max-md:bottom-[calc(4.75rem+env(safe-area-inset-bottom))] md:right-6 md:bottom-6 md:py-3.5 md:pl-4 md:pr-5"
    >
      <SendHorizontal className="size-5 shrink-0 text-[#229ED9] md:size-[22px]" />
      {/* Short label on phones, full label on desktop — always visible. */}
      <span className="text-sm font-extrabold tracking-tight md:hidden">Support</span>
      <span className="hidden text-sm font-extrabold tracking-tight md:inline">
        Chat with support
      </span>
    </a>
  );
}
