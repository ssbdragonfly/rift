
import { Github } from "lucide-react";

export const Footer = () => {
  return (
    <footer className="border-t border-gray-200 py-12 px-6">
      <div className="max-w-7xl mx-auto">
        <div className="flex flex-col md:flex-row items-center justify-between">
          <div className="text-2xl font-bold mb-4 md:mb-0">Rift</div>
          
          <div className="flex items-center space-x-6">
            <a 
              href="https://github.com/ssbdragonfly/rift" 
              target="_blank" 
              rel="noopener noreferrer"
              className="flex items-center space-x-2 text-gray-600 hover:text-black transition-colors duration-200"
            >
              <Github size={18} />
              <span>GitHub Repository</span>
            </a>
          </div>
        </div>
        
        <div className="mt-8 pt-8 border-t border-gray-200 text-center text-gray-500 text-sm">
          © 2025 Rift. Open source productivity assistant.
        </div>
      </div>
    </footer>
  );
};
