import type { Metadata } from "next";
import { AccountExperience } from "./account-experience";
import { ResearchAccessGate } from '../research-access-gate';

export const metadata: Metadata = {
  title: "Account — Phynite",
  description: "Manage your research profile, compute resources, usage, and account settings.",
};

export default function AccountPage() {
  return <ResearchAccessGate><AccountExperience /></ResearchAccessGate>;
}
