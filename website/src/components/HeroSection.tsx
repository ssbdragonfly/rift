
export const HeroSection = () => {
  return (
    <section className="py-32 px-6 text-center">
      <div className="max-w-4xl mx-auto">
        <h1 className="text-6xl font-bold mb-6 leading-tight">
          Your intelligent productivity bridge
        </h1>
        <p className="text-xl text-gray-600 mb-12 max-w-2xl mx-auto">
          Control your digital life with natural language commands. Currently integrates with Google's ecosystem, with more platforms coming soon.
        </p>
        
        <div className="flex flex-col sm:flex-row items-center justify-center space-y-4 sm:space-y-0 sm:space-x-6 mb-16">
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
        
        <div className="bg-gray-100 border border-gray-200 aspect-video max-w-3xl mx-auto overflow-hidden">
          <video 
            className="w-full h-full object-cover"
            src="/recording.mp4"
            autoPlay
            muted
            loop
            playsInline
          />
        </div>
      </div>
    </section>
  );
};