"use client";

export function PrintButton() {
  return <button className="button button-primary print-hide" type="button" onClick={() => window.print()}>Print pay record</button>;
}
