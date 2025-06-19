
import { Github } from "lucide-react";

export const Header = () => {
  return (
    <header className="border-b border-gray-200 bg-white">
      <div className="max-w-7xl mx-auto px-6 py-4">
        <div className="flex items-center justify-between">
          <div className="text-2xl font-bold tracking-tight">Rift</div>
          
          <nav className="hidden md:flex items-center space-x-8">
            <a 
              href="#download" 
              className="text-gray-600 hover:text-black transition-colors duration-200"
            >
              Download
            </a>
            <a 
              href="#features" 
              className="text-gray-600 hover:text-black transition-colors duration-200"
            >
              Features
            </a>
            <a 
              href="https://github.com/ssbdragonfly/rift" 
              target="_blank" 
              rel="noopener noreferrer"
              className="flex items-center space-x-2 text-gray-600 hover:text-black transition-colors duration-200"
            >
              <Github size={18} />
              <span>GitHub</span>
            </a>
          </nav>
        </div>
      </div>
    </header>
  );
};
