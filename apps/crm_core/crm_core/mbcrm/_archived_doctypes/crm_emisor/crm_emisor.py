from frappe.model.document import Document


class CRMEmisor(Document):
    """Datos fiscales INFORMATIVOS del emisor.

    A proposito NO guarda el certificado ni la clave privada de AFIP: son secretos y van
    con almacenamiento cifrado y roles propios cuando F6 integre el webservice.
    """
    pass
