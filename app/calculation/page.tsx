import { LegacyProjectRoute } from '@/components/LegacyProjectRoute';
import type { Metadata } from "next";
import { CalculationExperience } from "./calculation-experience";
import { ResearchAccessGate } from '../research-access-gate';

export const metadata: Metadata = {
  title: "DFT Lab — Phynite",
  description:
    "Build crystal structures and prepare first-principles calculations in the Phynite workspace.",
};

export default function CalculationPage() {
  return <ResearchAccessGate><LegacyProjectRoute kind="dft"><CalculationExperience /></LegacyProjectRoute></ResearchAccessGate>;
}
