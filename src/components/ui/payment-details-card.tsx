import { useQuery } from "@tanstack/react-query";
import { Copy } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { api, PAYMENT_DETAILS_FALLBACK, type PaymentDetails } from "@/lib/api";

/** Live receiving details (superadmin-editable), with offline fallback. */
export function usePaymentDetails() {
  return useQuery({
    queryKey: ["payment-details"],
    queryFn: () => api<PaymentDetails>("/api/payment/details"),
    retry: false,
    placeholderData: PAYMENT_DETAILS_FALLBACK,
  });
}

function CopyButton({ value, label }: { value: string; label: string }) {
  return (
    <Button
      type="button"
      size="icon"
      variant="outline"
      className="shrink-0 rounded-full bg-muted"
      aria-label={`Copy ${label}`}
      onClick={() => {
        void navigator.clipboard.writeText(value);
        toast.success(`${label} copied`);
      }}
    >
      <Copy className="size-4" />
    </Button>
  );
}

function DetailRow({
  label,
  value,
  copyLabel,
}: {
  label: string;
  value: string;
  copyLabel: string;
}) {
  return (
    <div className="flex items-center gap-3">
      <div className="min-w-0 flex-1 overflow-hidden">
        <p className="text-muted-foreground text-xs font-semibold">{label}</p>
        <p className="truncate font-mono text-lg font-semibold tabular-nums">{value}</p>
      </div>
      <CopyButton value={value} label={copyLabel} />
    </div>
  );
}

/**
 * The "SEND PAYMENT TO" card every manual buy surface renders: the exact
 * receiving details for the customer's country, with copy buttons. Ghana
 * pays by Mobile Money transfer; Nigeria by bank transfer.
 */
export function SendPaymentToCard({
  country,
  details,
}: {
  country: "ghana" | "nigeria";
  details: PaymentDetails;
}) {
  if (country === "ghana") {
    const gh = details.ghana;
    return (
      <div className="card-surface overflow-hidden p-6">
        <div className="kente-strip -mx-6 -mt-6 mb-5 h-[6px] w-[calc(100%+3rem)]" aria-hidden />
        <h2 className="text-lg font-bold">Pay with Mobile Money</h2>
        <p className="text-muted-foreground mt-2 text-sm leading-relaxed">
          Send the exact amount to the MoMo number below, then enter your payment details. Your
          access starts once the payment is confirmed.
        </p>
        <div className="border-primary/30 bg-primary/5 mt-5 space-y-4 rounded-2xl border-2 border-dashed p-5">
          <p className="text-xs font-bold text-primary">Send payment to</p>
          <DetailRow label="Account name" value={gh.accountName} copyLabel="Account name" />
          <DetailRow label="MoMo number" value={gh.momoNumber} copyLabel="MoMo number" />
        </div>
      </div>
    );
  }
  const ng = details.nigeria;
  return (
    <div className="card-surface overflow-hidden p-6">
      <div className="kente-strip -mx-6 -mt-6 mb-5 h-[6px] w-[calc(100%+3rem)]" aria-hidden />
      <h2 className="text-lg font-bold">Pay with bank transfer</h2>
      <p className="text-muted-foreground mt-2 text-sm leading-relaxed">
        Send the exact amount to the bank account below, then enter your payment details. Your
        access starts once the payment is confirmed.
      </p>
      <div className="border-primary/30 bg-primary/5 mt-5 space-y-4 rounded-2xl border-2 border-dashed p-5">
        <p className="text-xs font-bold text-primary">Send payment to</p>
        <DetailRow label="Bank" value={ng.bankName} copyLabel="Bank name" />
        <DetailRow label="Account number" value={ng.accountNumber} copyLabel="Account number" />
        <DetailRow label="Receiver name" value={ng.receiverName} copyLabel="Receiver name" />
      </div>
    </div>
  );
}
