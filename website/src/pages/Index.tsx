
import { useState } from "react";
import { Header } from "../components/Header";
import { HeroSection } from "../components/HeroSection";
import { CapabilitiesSection } from "../components/CapabilitiesSection";
import { CommandExamples } from "../components/CommandExamples";
import { HowItWorks } from "../components/HowItWorks";
import { DownloadSection } from "../components/DownloadSection";
import { Footer } from "../components/Footer";

const Index = () => {
  return (
    <div className="min-h-screen bg-white text-black">
      <Header />
      <HeroSection />
      <CapabilitiesSection />
      <CommandExamples />
      <HowItWorks />
      <DownloadSection />
      <Footer />
    </div>
  );
};

export default Index;
