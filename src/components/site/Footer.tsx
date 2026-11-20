import { Link } from "@tanstack/react-router";

import { Brand } from "./Header";

export function Footer() {
  return (
    <footer className="border-t border-border bg-white">
      <div className="kente-strip h-[6px] w-full" aria-hidden />
      <div className="mx-auto w-full max-w-6xl px-4 py-12 sm:px-6">
        <div className="grid gap-10 sm:grid-cols-2 lg:grid-cols-4">
          <div className="space-y-3">
            <Brand compact />
            <p className="text-muted-foreground max-w-xs text-sm leading-relaxed">
              Four tiers, AI calls and slip scans — built for Ghana. Pay with Mobile
              Money, get in, get value.
            </p>
          </div>

          <div>
            <h4 className="mb-3 text-sm font-semibold">Product</h4>
            <ul className="text-muted-foreground space-y-2 text-sm">
              <li>
                <Link to="/pricing" className="hover:text-foreground transition-colors">
                  Access plans
                </Link>
              </li>
              <li>
                <Link to="/scan" className="hover:text-foreground transition-colors">
                  AI slip scan
                </Link>
              </li>
              <li>
                <Link to="/manual-payment" className="hover:text-foreground transition-colors">
                  Manual payment
                </Link>
              </li>
            </ul>
          </div>

          <div>
            <h4 className="mb-3 text-sm font-semibold">Account</h4>
            <ul className="text-muted-foreground space-y-2 text-sm">
              <li>
                <Link to="/register" className="hover:text-foreground transition-colors">
                  Register
                </Link>
              </li>
              <li>
                <Link to="/login" className="hover:text-foreground transition-colors">
                  Log in
                </Link>
              </li>
              <li>
                <Link to="/dashboard" className="hover:text-foreground transition-colors">
                  My session
                </Link>
              </li>
            </ul>
          </div>

          <div>
            <h4 className="mb-3 text-sm font-semibold">Staff</h4>
            <ul className="text-muted-foreground space-y-2 text-sm">
              <li>
                <Link to="/admin/login" className="hover:text-foreground transition-colors">
                  Admin login
                </Link>
              </li>
              <li>
                <Link to="/superadmin/login" className="hover:text-foreground transition-colors">
                  Super admin login
                </Link>
              </li>
            </ul>
          </div>
        </div>

        <div className="text-muted-foreground mt-10 flex flex-col gap-2 border-t border-border pt-6 text-xs sm:flex-row sm:items-center sm:justify-between">
          <p>&copy; {new Date().getFullYear()} SignalVault. All rights reserved.</p>
          <p>Passwords are shown once. Save them safely.</p>
        </div>
      </div>
    </footer>
  );
}
