
import { ArrowDown } from "lucide-react";

export const DownloadSection = () => {
  return (
    <section id="download" className="py-24 px-6">
      <div className="max-w-4xl mx-auto text-center">
        <h2 className="text-4xl font-bold mb-4">Download Rift</h2>
        <p className="text-xl text-gray-600 mb-12">
          Get started with your productivity assistant
        </p>
        
        <div className="max-w-md mx-auto mb-12">
          <a 
            href="/rift.zip" 
            className="bg-black text-white p-8 hover:bg-gray-800 transition-colors duration-200 group block"
          >
            <div className="text-2xl font-semibold mb-2">Download Rift</div>
            <div className="text-gray-300 text-sm mb-4">Version 1.0.0</div>
            <div className="flex items-center justify-center space-x-2 group-hover:translate-y-0.5 transition-transform duration-200">
              <ArrowDown size={18} />
              <span>Download</span>
            </div>
          </a>
        </div>
        
        <p className="text-gray-500">
          <a 
            href="https://github.com/ssbdragonfly/rift" 
            target="_blank" 
            rel="noopener noreferrer"
            className="hover:text-black transition-colors duration-200"
          >
            View source code on GitHub →
          </a>
        </p>
      </div>
    </section>
  );
};
