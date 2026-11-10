/** Editorial demostrativa 9C. No IDs de catálogo, precios ni disponibilidad operativa. */
export const featuredTreatments = [
  { title: 'Revisión y limpieza', description: 'El primer paso para conocer tu salud bucal y acompañar tus hábitos de higiene.', image: 'care', alt: 'Fotografía de stock de una revisión dental' },
  { title: 'Ortodoncia', description: 'Opciones para la alineación dental, siempre a partir de una valoración individual.', image: 'orthodontics', alt: 'Modelo dental de demostración con brackets' },
  { title: 'Restauración dental', description: 'Conoce las alternativas para recuperar la forma y la función de los dientes.', image: 'implants', alt: 'Modelo dental de demostración' },
  { title: 'Odontopediatría', description: 'Prevención y cuidado bucal que acompañan a los más pequeños en cada etapa.', image: 'children', alt: 'Fotografía de stock de una revisión dental infantil' },
] as const;

export const careBenefits = [
  { icon: 'people', title: 'Atención personalizada', description: 'Cada sonrisa tiene su historia. Escuchar tus necesidades es el punto de partida.' },
  { icon: 'shield', title: 'Información clara', description: 'Entender las opciones y resolver tus dudas también forma parte del cuidado.' },
  { icon: 'heart', title: 'Una experiencia tranquila', description: 'Un enfoque cercano, con espacio para hablar de lo que te preocupa.' },
  { icon: 'spark', title: 'Prevención y educación', description: 'Pequeños hábitos cotidianos para acompañar tu salud bucal a largo plazo.' },
] as const;

export const visitSteps = [
  { icon: 'people', title: 'Accede a tu cuenta', description: 'Inicia sesión o regístrate como paciente para comenzar.' },
  { icon: 'calendar', title: 'Elige tu cita', description: 'Consulta los servicios, profesionales y horarios disponibles en el sistema.' },
  { icon: 'check', title: 'Revisa tu reserva', description: 'Comprueba los datos antes de crear la cita y consúltala en tu agenda.' },
  { icon: 'heart', title: 'Prepara tu visita', description: 'Anota tus dudas y la información que quieras compartir durante la consulta.' },
] as const;

export const frequentQuestions = [
  { question: '¿Cómo puedo reservar una cita?', answer: 'Entra en «Reservar cita» e inicia sesión. Si aún no tienes cuenta, puedes registrarte como paciente. Después elige un servicio activo, un profesional y uno de los horarios que devuelve el sistema.' },
  { question: '¿Los tratamientos de esta página se pueden reservar?', answer: 'Los tratamientos destacados son una selección informativa de esta clínica ficticia. No representan el catálogo operativo. Al reservar verás únicamente los servicios activos y la disponibilidad real del sistema.' },
  { question: '¿Con qué frecuencia necesito una revisión dental?', answer: 'La frecuencia depende de tus necesidades y antecedentes. Un profesional puede orientarte tras una valoración individual. Esta página ofrece información general y no sustituye una consulta.' },
  { question: '¿La primera consulta incluye radiografías?', answer: 'No se presuponen pruebas ni procedimientos incluidos. Su necesidad se determina durante la valoración profesional, según cada caso.' },
  { question: '¿Puedo cambiar o cancelar mi cita?', answer: 'Desde tu agenda puedes consultar las acciones disponibles para tus citas. La reserva, cancelación y reprogramación están sujetas a las políticas vigentes que muestra el sistema.' },
] as const;

/** Procedencia/licencia verificadas el 2026-10-16. Sin hotlinks en imágenes renderizadas. */
export const imageCredits = [
  { label: 'Consultorio · Pavel Danilyuk', url: 'https://www.pexels.com/photo/blue-and-white-dental-chair-6809634/' },
  { label: 'Revisión · Anna Shvets', url: 'https://www.pexels.com/photo/dental-check-up-3845736/' },
  { label: 'Modelo con brackets', url: 'https://www.pexels.com/photo/model-of-jaw-with-teeth-19328507/' },
  { label: 'Modelo dental', url: 'https://www.pexels.com/photo/gums-and-teeth-figurine-5794074/' },
  { label: 'Atención infantil · Karola G', url: 'https://www.pexels.com/photo/dentist-in-a-green-medical-coat-checking-childs-teeth-with-a-mirror-6627408/' },
  { label: 'Interior · Tima Miroshnichenko', url: 'https://www.pexels.com/photo/interior-of-a-dentist-office-with-chairs-and-equipment-5355921/' },
] as const;
