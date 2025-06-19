
export const HowItWorks = () => {
  const steps = [
    {
      number: "1",
      title: "Activate",
      description: "Press Cmd+Shift+Space to open Rift"
    },
    {
      number: "2", 
      title: "Command",
      description: "Type your request in natural language"
    },
    {
      number: "3",
      title: "Execute",
      description: "Rift handles authentication and execution"
    },
    {
      number: "4",
      title: "Complete",
      description: "Results appear instantly in your apps"
    }
  ];

  return (
    <section className="py-24 px-6 bg-gray-50">
      <div className="max-w-6xl mx-auto">
        <div className="text-center mb-16">
          <h2 className="text-4xl font-bold mb-4">How It Works</h2>
          <p className="text-xl text-gray-600">
            Four simple steps to transform how you work
          </p>
        </div>
        
        <div className="grid md:grid-cols-4 gap-8">
          {steps.map((step, index) => (
            <div key={index} className="text-center">
              <div className="w-16 h-16 bg-black text-white rounded-full flex items-center justify-center text-xl font-bold mx-auto mb-6">
                {step.number}
              </div>
              <h3 className="text-xl font-semibold mb-3">{step.title}</h3>
              <p className="text-gray-600">{step.description}</p>
              
              {index < steps.length - 1 && (
                <div className="hidden md:block absolute top-8 left-full w-8 h-0.5 bg-gray-300 transform translate-x-4"></div>
              )}
            </div>
          ))}
        </div>
      </div>
    </section>
  );
};
