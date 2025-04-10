const Header = () => {
  return (
    <header className="bg-white border-b border-neutral-200 py-3 px-4 md:px-6 sticky top-0 z-10 shadow-sm">
      <div className="max-w-7xl mx-auto flex items-center justify-between">
        <div className="flex items-center gap-3">
          <svg viewBox="0 0 203.7 41.2" xmlns="http://www.w3.org/2000/svg" width="120" height="24" className="flex-shrink-0">
            <path d="M72.2 20.6c0-3.4 2.5-6.3 6.2-6.3s6.1 2.9 6.1 6.2c0 3.3-2.5 6.2-6.2 6.2-3.6.1-6.1-2.8-6.1-6.1m10.9 0c0-2.8-2-5-4.8-5s-4.7 2.2-4.7 4.9 2 5 4.8 5c2.8.1 4.7-2.2 4.7-4.9m22.4 6h1.3v-9.9l7.8 9.9h1.1V14.5h-1.3v9.7l-7.6-9.7h-1.3zm23.4 0h1.4v-5.3h6.5v-1.2h-6.5v-4.3h7.3v-1.3h-8.7zm13.5 0h8.8v-1.2h-7.4v-4.2h6.6V20h-6.6v-4.1h7.4v-1.2h-8.7v11.9zm48.2 0h1.4v-4.8l5-7.3h-1.6l-4.1 6-4.1-6h-1.7l5 7.3v4.8zm-25.5 0h1.7l-3.7-4.9c1.9-.3 3.3-1.5 3.3-3.5 0-1-.3-1.8-.9-2.4-.8-.8-1.9-1.2-3.4-1.2h-5.2v12.1h1.4V22h3.5zm-7-10.8h3.7c1.9 0 3.1.9 3.1 2.4s-1.2 2.4-2.8 2.5h-4zm22.4 10.8h1.7l-3.7-4.9c1.9-.3 3.3-1.5 3.3-3.5 0-1-.3-1.8-.9-2.4-.8-.8-1.9-1.2-3.4-1.2h-5.2v12.1h1.4V22h3.5zm-6.9-10.8h3.7c1.9 0 3.1.9 3.1 2.4s-1.2 2.4-2.8 2.5h-4zM98.4 26.6h1.7l-3.7-4.9c1.9-.3 3.3-1.5 3.3-3.5 0-1-.3-1.8-.9-2.4-.8-.8-1.9-1.2-3.4-1.2H90v12.1h1.4V22h3.5zm-7-10.8h3.7c1.9 0 3.1.9 3.1 2.4s-1.2 2.4-2.8 2.5h-4zm-31.1-1.3h-1.4v12.1h1.4zm3.5 5.3l5.2-5.3h-1.8l-5.1 5.3 5.4 6.8h1.7zM21.6 36.8v.5h-9.4L0 19.8 13.8 3.9h4v.5H14L4.2 15.7 19 36.8zm7.5-32.9v.5h4c6.7 0 10.1 4 11.5 10.3h.4V3.9zm0 16.2v.5c7.1 0 7.7 4.7 7.9 7h.4V13.2H37c-.4 4.6-2.4 6.9-7.9 6.9M24.7 0h-.5v41.2h.5zM202.1 17.7c-.2 0-.5 0-.7-.1s-.4-.2-.5-.4c-.2-.2-.3-.3-.4-.5s-.1-.4-.1-.7c0-.2 0-.4.1-.6s.2-.4.4-.5c.2-.2.3-.3.5-.4s.4-.1.7-.1c.2 0 .4 0 .6.1s.4.2.5.4c.2.2.3.3.4.5s.1.4.1.6 0 .5-.1.7-.2.4-.4.5c-.2.2-.3.3-.5.4s-.4.1-.6.1m0-.2c.2 0 .4 0 .6-.1s.3-.2.4-.3.2-.3.3-.5.1-.4.1-.6 0-.4-.1-.6-.2-.3-.3-.5c-.1-.1-.3-.2-.4-.3-.2-.1-.4-.1-.6-.1s-.4 0-.6.1-.3.2-.4.3-.2.3-.3.5-.1.4-.1.6 0 .4.1.6.2.3.3.5c.1.1.3.2.4.3.2.1.4.1.6.1m.8-.5h-.3l-.5-.9h-.4v.9h-.2v-1.9h.8c.2 0 .4 0 .5.1s.1.2.1.4v.2c0 .1-.1.1-.1.2-.1 0-.1.1-.2.1h-.2zm-.9-1.1h.4c.1 0 .1-.1.2-.1s.1-.1.1-.2v-.2l-.1-.1h-.9v.7h.3z"/>
          </svg>
        </div>
        
        <div className="flex items-center gap-3">
          <div className="bg-primary-100 text-primary-700 px-3 py-1 rounded-full text-sm font-medium hidden md:flex items-center">
            <span className="w-2 h-2 bg-primary-500 rounded-full mr-2 animate-pulse"></span>
            Live
          </div>
        </div>
      </div>
    </header>
  );
};

export default Header; 
