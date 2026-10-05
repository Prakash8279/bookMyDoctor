export function WhatsAppButton() {
  const whatsappUrl = 'https://wa.me/917323074966?text=Hi%20BookMyDoctors%2C%20I%20would%20like%20to%20inquire%20about%20doctor%20appointments.'

  return (
    <a
      href={whatsappUrl}
      target="_blank"
      rel="noopener noreferrer"
      aria-label="Chat with BookMyDoctors on WhatsApp"
      className="fixed bottom-6 right-6 z-50 flex items-center gap-2 rounded-full bg-[#25D366] px-4 py-3 text-white shadow-xl transition-all duration-300 hover:scale-105 hover:bg-[#20ba5a] hover:shadow-2xl focus:outline-none focus:ring-4 focus:ring-[#25D366]/40"
      style={{ boxShadow: '0 8px 24px rgba(37, 211, 102, 0.4)' }}
    >
      <svg
        xmlns="http://www.w3.org/2000/svg"
        width="24"
        height="24"
        viewBox="0 0 24 24"
        fill="currentColor"
        className="h-6 w-6"
      >
        <path d="M12.031 6.172c-3.181 0-5.767 2.586-5.768 5.766-.001 1.298.38 2.27 1.019 3.287l-.582 2.128 2.182-.573c.978.58 1.911.928 3.145.929 3.178 0 5.767-2.587 5.768-5.766.001-3.187-2.575-5.77-5.764-5.771zm3.392 8.244c-.144.405-.837.774-1.17.824-.311.045-.698.072-2.126-.519-1.815-.752-2.984-2.587-3.074-2.709-.089-.122-.738-.981-.738-1.871 0-.89.467-1.328.633-1.509.167-.18.364-.225.486-.225.122 0 .244.001.35.006.113.005.263-.043.411.314.155.372.531 1.294.577 1.388.046.094.077.204.015.328-.061.124-.092.202-.183.308-.091.106-.192.237-.274.318-.092.091-.188.19-.081.374.107.184.475.783 1.021 1.269.702.626 1.294.82 1.478.911.185.091.292.08.401-.046.108-.125.467-.544.591-.73.124-.186.248-.155.417-.093.169.062 1.077.508 1.262.6.185.093.308.139.354.217.046.079.046.455-.098.86z"/>
        <path d="M12 2C6.477 2 2 6.477 2 12c0 1.891.523 3.662 1.436 5.176L2 22l4.981-1.399C8.423 21.493 10.153 22 12 22c5.523 0 10-4.477 10-10S17.523 2 12 2zm0 18.063c-1.667 0-3.219-.481-4.536-1.309l-.326-.205-2.97.834.846-2.906-.222-.341C3.904 14.73 3.4 13.409 3.4 12c0-4.742 3.858-8.6 8.6-8.6 4.741 0 8.6 3.858 8.6 8.6 0 4.741-3.859 8.063-8.6 8.063z"/>
      </svg>
      <span className="text-sm font-semibold tracking-wide">WhatsApp</span>
    </a>
  )
}
