
export const HeroSection = () => {
  return (
    <section className="py-20 px-6">
      <div className="max-w-7xl mx-auto">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-12 items-center">
          <div className="text-left">
            <h1 className="text-5xl md:text-6xl font-bold mb-6 leading-tight">
              Your intelligent productivity bridge
            </h1>
            <p className="text-xl text-gray-600 mb-8">
              Control your digital life with natural language commands. Currently integrates with Google's ecosystem, with more platforms coming soon.
            </p>
            
            <div className="flex flex-col sm:flex-row items-start sm:items-center space-y-4 sm:space-y-0 sm:space-x-6">
              <a 
                href="#download" 
                className="bg-black text-white px-8 py-4 text-lg font-semibold hover:bg-gray-800 transition-colors duration-200"
              >
                Download Rift
              </a>
              <a 
                href="https://github.com/ssbdragonfly/rift"
                target="_blank" 
                rel="noopener noreferrer"
                className="text-gray-600 hover:text-black transition-colors duration-200 flex items-center space-x-2"
              >
                <span>View on GitHub</span>
                <span>→</span>
              </a>
            </div>
          </div>
          
          <div className="relative rounded-xl overflow-hidden border border-gray-200 shadow-xl bg-gray-100">
            <video 
              className="w-full h-full object-cover"
              src="/recording.mp4"
              autoPlay
              muted
              loop
              playsInline
            />
            <div className="absolute inset-0 bg-gradient-to-tr from-black/5 to-transparent pointer-events-none"></div>
          </div>
        </div>
      </div>
    </section>
  );
};