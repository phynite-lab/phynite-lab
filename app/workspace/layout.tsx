import type { Metadata } from "next";
import "../lab-ui.css";
import "../private-ui.css";
import "../calculation-workspace.css";
import "../workspace-product-header.css";
import "../figures-workspace.css";
import "../lab-controls.css";

export const metadata: Metadata = { robots: { index: false, follow: false } };
export default function AreaLayout({ children }: { children: React.ReactNode }) { return children; }
