
export const CommandExamples = () => {
  const examples = [
    "Schedule a team meeting tomorrow at 10am",
    "Check my unread emails and summarize them", 
    "Find my marketing presentation and share it with john@example.com",
    "Create a Google Doc for meeting notes and share with the team"
  ];

  return (
    <section className="py-24 px-6">
      <div className="max-w-4xl mx-auto text-center">
        <h2 className="text-4xl font-bold mb-4">Simple Commands, Powerful Results</h2>
        <p className="text-xl text-gray-600 mb-16">
          Just type what you want to do in natural language
        </p>
        
        <div className="space-y-6">
          {examples.map((example, index) => (
            <div key={index} className="bg-gray-50 border border-gray-200 p-6 text-left">
              <div className="flex items-center space-x-3">
                <div className="w-2 h-2 bg-gray-400 rounded-full"></div>
                <code className="text-lg font-mono">{example}</code>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
};
