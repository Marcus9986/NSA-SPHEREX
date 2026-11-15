import http.client
import time
import urllib.error

import numpy as np
import matplotlib.pyplot as plt

from astropy.io import fits
from astropy.wcs import WCS
from astropy.table import Table
from astropy import units as u
from astropy.coordinates import SkyCoord

from astroquery.ipac.irsa import Irsa

from firefly_client import FireflyClient

# The time it takes to read SPHEREx files can exceed
# astropy's default timeout limit. Increase it.
from astropy.utils.data import conf
conf.remote_timeout = 120

ra_deg = 304.693508800
dec_deg = 42.4436872991

coord = SkyCoord(ra_deg, dec_deg, unit='deg')
search_radius = 1 * u.arcsec

collection = Irsa.list_collections(servicetype='SIA', filter='spherex')

print(collection)

results = Irsa.query_sia(pos=(coord, search_radius), collection=['spherex_dr1', 'spherex_qr3'])

print(results)

print(results.colnames)

spectral_image_url = results['access_url'][0]
print(spectral_image_url)


# Max number of times to retry HTTP errors.
max_retries = 3
for attempt in range(max_retries):
    try:
        # Load the data, reading every extension into memory so that
        # hdulist stays usable after the file is closed.
        with fits.open(spectral_image_url, memmap=False) as hdulist:
            for hdu in hdulist:
                hdu.data
        break
    except (TimeoutError, urllib.error.HTTPError, http.client.IncompleteRead):
        if attempt == max_retries - 1:
            raise
        time.sleep(10 * (attempt + 1))


hdulist.info()

fc = FireflyClient.make_client(url="https://irsa.ipac.caltech.edu/irsaviewer")

fc.reinit_viewer()

fc.show_fits_image(file_input=spectral_image_url,
             plot_id="spectral_image",
             Title="Spectral Image"
             )


spectral_image_header = hdulist[1].header

keywords_to_print = ['EXTNAME', 'NAXIS1', 'NAXIS2', 'BUNIT', 'DETECTOR', 'OBSID', 'DATE', 'PSF_FWHM']

for keyword in keywords_to_print:
    value = spectral_image_header.get(keyword, 'Keyword not found')
    print(f"{keyword}: {value}")


print(spectral_image_header['WCSNAME*'])