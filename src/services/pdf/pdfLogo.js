// src/services/pdf/pdfLogo.js
// Cargador dinámico de logos para PDFs
// Si viene logo_url en la configuración, lo descarga y convierte a base64
// Si no, retorna null para no renderizar ningún logo (marca blanca por defecto)

export async function cargarLogo(logoUrl) {
  if (!logoUrl || logoUrl.trim() === '' || logoUrl.toUpperCase() === 'PRUEBA') {
    return null;
  }
  
  if (logoUrl.startsWith('data:')) {
    return logoUrl;
  }
  
  try {
    const response = await fetch(logoUrl);
    const blob = await response.blob();
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onloadend = () => resolve(reader.result);
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });
  } catch (error) {
    console.error('Error cargando logo personalizado:', error);
    return null;
  }
}
