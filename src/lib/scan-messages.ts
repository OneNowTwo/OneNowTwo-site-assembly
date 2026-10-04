/** Final customer-facing message set after valuation completes. */
export function finaliseScanMessages(messages: string[], valuationFinished: boolean): string[] {
  return messages.filter((message) => {
    if (/commercial licence|MVP\/research PSI/i.test(message)) return false;
    if (valuationFinished && /FINANCIAL RANKING PENDING PROPERTY VALUES/i.test(message)) return false;
    return true;
  });
}
