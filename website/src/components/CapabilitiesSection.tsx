
export const CapabilitiesSection = () => {
  const capabilities = [
    {
      title: "Calendar Management",
      description: "Create, modify, and query events with natural language commands"
    },
    {
      title: "Email Integration", 
      description: "Check, compose, and manage emails through simple voice commands"
    },
    {
      title: "Document Access",
      description: "Find, open, and share documents across your cloud storage"
    },
    {
      title: "Meeting Coordination",
      description: "Set up meetings and coordinate with your team effortlessly"
    }
  ];

  return (
    <section id="features" className="py-24 px-6 bg-gray-50">
      <div className="max-w-6xl mx-auto">
        <div className="text-center mb-16">
          <h2 className="text-4xl font-bold mb-4">Key Capabilities</h2>
          <p className="text-xl text-gray-600">
            Currently supports Google Workspace, with more integrations coming
          </p>
        </div>
        
        <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-8">
          {capabilities.map((capability, index) => (
            <div key={index} className="text-center">
              <div className="w-16 h-16 bg-black mx-auto mb-4 flex items-center justify-center">
                <div className="w-8 h-8 border-2 border-white"></div>
              </div>
              <h3 className="text-xl font-semibold mb-3">{capability.title}</h3>
              <p className="text-gray-600">{capability.description}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
};
